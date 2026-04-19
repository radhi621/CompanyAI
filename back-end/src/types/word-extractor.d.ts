declare module "word-extractor" {
  export interface ExtractedWordDocument {
    getBody(): string;
  }

  export default class WordExtractor {
    extract(filePath: string): Promise<ExtractedWordDocument>;
  }
}
