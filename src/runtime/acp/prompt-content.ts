import { pathToFileURL } from "node:url"
import type { ContentBlock } from "@agentclientprotocol/sdk"
import type { AiPromptFileRef } from "../client/types.ts"

// Builds the ACP prompt content for a turn: the message text followed by one
// `resource_link` block per referenced file/directory. Agents baseline-support
// resource_link, so this delivers file references as first-class links instead
// of raw paths inlined into the text (which is ambiguous and, when a path leads
// the message, can be mis-read as a slash command).
export function buildPromptContent(
  text: string,
  refs?: AiPromptFileRef[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: "text", text }]
  for (const ref of refs ?? []) {
    blocks.push({
      type: "resource_link",
      uri: pathToFileURL(ref.path).href,
      name: ref.name,
    })
  }
  return blocks
}
