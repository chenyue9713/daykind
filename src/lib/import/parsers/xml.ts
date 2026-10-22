// A minimal, non-validating, streaming XML tokenizer for TCX. It is
// deliberately strict: any DOCTYPE or other markup declaration is rejected, so
// there are no external entities, no entity expansion, and no network or file
// access. Only the five predefined entities and numeric character references
// are decoded. Depth, element count, attribute count, text length, and time
// are bounded.
import {
  Deadline,
  MAX_XML_ATTRIBUTES,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_TEXT_LENGTH,
} from "../limits";
import { ImportFailure } from "../types";

export interface XmlHandler {
  /** `name` is the local name with any namespace prefix removed. */
  open(name: string, attributes: Record<string, string>): void;
  close(name: string): void;
  text(value: string): void;
}

const corrupt = (detail: string) =>
  new ImportFailure("corrupt", `This TCX file is damaged or not valid XML (${detail}). Export the workout again.`);

const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;&\s]{1,10});/g, (_, ref: string) => {
    if (ref in PREDEFINED) return PREDEFINED[ref];
    const code = ref.startsWith("#x") ? parseInt(ref.slice(2), 16) : ref.startsWith("#") ? parseInt(ref.slice(1), 10) : NaN;
    if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
      return String.fromCodePoint(code);
    }
    // Without a DTD any other entity is undeclared, which XML defines as an error.
    throw corrupt("undeclared entity");
  });
}

const localName = (qualified: string) => {
  const colon = qualified.indexOf(":");
  return colon === -1 ? qualified : qualified.slice(colon + 1);
};

const NAME = /^[A-Za-z_][\w.:-]{0,255}$/;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let count = 0;
  let consumed = 0;
  ATTRIBUTE.lastIndex = 0;
  for (let m = ATTRIBUTE.exec(source); m; m = ATTRIBUTE.exec(source)) {
    if (source.slice(consumed, m.index).trim()) throw corrupt("malformed attribute");
    consumed = m.index + m[0].length;
    if (++count > MAX_XML_ATTRIBUTES) {
      throw new ImportFailure("too_complex", "This TCX file is too complex to read safely. Export a single workout instead.");
    }
    if (!NAME.test(m[1])) throw corrupt("malformed attribute");
    attributes[localName(m[1])] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  if (source.slice(consumed).trim()) throw corrupt("malformed attribute");
  return attributes;
}

export function parseXml(input: string, handler: XmlHandler, deadline = new Deadline()): void {
  const stack: string[] = [];
  let pos = 0;
  let elements = 0;
  let sawRoot = false;
  const n = input.length;

  const expect = (terminator: string, from: number, what: string) => {
    const end = input.indexOf(terminator, from);
    if (end === -1) throw corrupt(`unterminated ${what}`);
    return end;
  };

  while (pos < n) {
    const lt = input.indexOf("<", pos);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > pos) {
      const raw = input.slice(pos, textEnd);
      if (stack.length === 0) {
        if (raw.trim()) throw corrupt("text outside the root element");
      } else {
        if (raw.length > MAX_XML_TEXT_LENGTH) {
          throw new ImportFailure("too_complex", "This TCX file contains an unusually large text field and was not read.");
        }
        handler.text(decodeEntities(raw));
      }
    }
    if (lt === -1) break;

    if (input.startsWith("<?", lt)) {
      pos = expect("?>", lt + 2, "processing instruction") + 2;
    } else if (input.startsWith("<!--", lt)) {
      pos = expect("-->", lt + 4, "comment") + 3;
    } else if (input.startsWith("<![CDATA[", lt)) {
      if (stack.length === 0) throw corrupt("CDATA outside the root element");
      const end = expect("]]>", lt + 9, "CDATA section");
      if (end - (lt + 9) > MAX_XML_TEXT_LENGTH) {
        throw new ImportFailure("too_complex", "This TCX file contains an unusually large text field and was not read.");
      }
      handler.text(input.slice(lt + 9, end));
      pos = end + 3;
    } else if (input.startsWith("<!", lt)) {
      throw new ImportFailure(
        "xml_dtd_forbidden",
        "This TCX file contains a document type declaration (DTD), which DayKind does not accept for safety. Garmin exports never include one; export the workout again from Garmin Connect.",
      );
    } else if (input.startsWith("</", lt)) {
      const end = expect(">", lt + 2, "closing tag");
      const name = input.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (open === undefined || open !== name) throw corrupt("mismatched closing tag");
      handler.close(localName(name));
      pos = end + 1;
    } else {
      const end = findTagEnd(input, lt + 1);
      const selfClosing = input[end - 1] === "/";
      const body = input.slice(lt + 1, selfClosing ? end - 1 : end);
      const nameEnd = body.search(/[\s]/);
      const name = nameEnd === -1 ? body : body.slice(0, nameEnd);
      if (!NAME.test(name)) throw corrupt("malformed tag");
      if (stack.length === 0 && sawRoot) throw corrupt("more than one root element");
      sawRoot = true;

      if (++elements > MAX_XML_ELEMENTS || stack.length >= MAX_XML_DEPTH) {
        throw new ImportFailure("too_complex", "This TCX file is too large or deeply nested to read safely. Export a single workout instead.");
      }
      if ((elements & 0xfff) === 0 && deadline.expired) {
        throw new ImportFailure("timeout", "This file took too long to read and was stopped. Export a single workout instead.");
      }

      const attributes = nameEnd === -1 ? {} : parseAttributes(body.slice(nameEnd));
      handler.open(localName(name), attributes);
      if (selfClosing) handler.close(localName(name));
      else stack.push(name);
      pos = end + 1;
    }
  }

  if (!sawRoot) throw corrupt("no root element");
  if (stack.length > 0) throw corrupt("file ends before the workout is complete");
}

/** Finds the `>` that ends a start tag, skipping `>` inside quoted attribute values. */
function findTagEnd(input: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    } else if (c === "<") {
      break;
    }
  }
  throw corrupt("unterminated tag");
}
