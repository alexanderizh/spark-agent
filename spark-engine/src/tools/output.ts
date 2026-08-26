import type { ArtifactStore } from '../seams.js';
import type { ArtifactRef } from '../events/schema.js';

export interface ProcessedToolOutput {
  readonly content: string;
  readonly artifact?: ArtifactRef;
}

export async function processToolOutput(
  content: string,
  artifacts: ArtifactStore,
  maxCharacters = 16_000,
): Promise<ProcessedToolOutput> {
  if (content.length <= maxCharacters) return { content };

  const artifact = await artifacts.put(content, 'text/plain');
  const headSize = Math.floor(maxCharacters * 0.6);
  const tailSize = maxCharacters - headSize;
  const omitted = content.length - maxCharacters;
  return {
    content: `${content.slice(0, headSize)}\n\n… ${omitted} characters omitted …\nFull output: ${artifact.readHint}\n\n${content.slice(-tailSize)}`,
    artifact,
  };
}
