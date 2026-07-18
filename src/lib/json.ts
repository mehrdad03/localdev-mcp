export function parseJsonDocument(output: string): unknown {
  const normalized = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
  if (!normalized) throw new Error("Command output was empty; no JSON document was found.");

  try {
    return JSON.parse(normalized);
  } catch {
    // Commands can print framework notices before or after their JSON payload.
  }

  let parsed: unknown = undefined;
  let parsedLength = -1;

  for (let start = 0; start < normalized.length; start += 1) {
    const opening = normalized[start];
    if (opening !== "{" && opening !== "[") continue;

    const stack: string[] = [opening];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") {
        stack.push(character);
        continue;
      }
      if (character !== "}" && character !== "]") continue;

      const expectedOpening = character === "}" ? "{" : "[";
      if (stack.at(-1) !== expectedOpening) break;
      stack.pop();
      if (stack.length > 0) continue;

      const candidate = normalized.slice(start, index + 1);
      try {
        const candidateParsed = JSON.parse(candidate);
        if (candidate.length > parsedLength) {
          parsed = candidateParsed;
          parsedLength = candidate.length;
        }
      } catch {
        // Continue scanning for another complete JSON document.
      }
      break;
    }
  }

  if (parsed === undefined) {
    throw new Error("Command output did not contain a valid JSON document.");
  }
  return parsed;
}
