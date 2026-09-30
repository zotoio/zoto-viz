// A JS module, not fixture.json: the sandbox CSP is connect-src 'none' and JSON module imports
// are fetched under connect-src, so a JSON import never loads (#180).
export default {
  bright: 0.92,
};
