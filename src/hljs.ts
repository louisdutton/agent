import hljs from "highlight.js/lib/core";

// Import only the languages we actually need
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import ini from "highlight.js/lib/languages/ini";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";

// Register languages
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);

export default hljs;
