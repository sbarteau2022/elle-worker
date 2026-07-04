// Corpus seed docs are bundled as Text modules (see wrangler.toml [[rules]]),
// so importing one yields its contents as a string.
declare module '*.md' {
  const content: string;
  export default content;
}
