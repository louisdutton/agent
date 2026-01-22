import { marked } from "marked";
import { bundledLanguages, codeToHtml } from "shiki";
import { createMemo } from "solid-js";

// Create a custom renderer that handles code blocks
const renderer = new marked.Renderer();

// Store for highlighted code blocks
const codeBlockCache = new Map<string, string>();

// Async function to highlight code
async function highlightCode(code: string, lang: string): Promise<string> {
	const cacheKey = `${lang}:${code}`;
	if (codeBlockCache.has(cacheKey)) {
		return codeBlockCache.get(cacheKey)!;
	}

	const validLang = lang && lang in bundledLanguages ? lang : "text";

	try {
		const html = await codeToHtml(code, {
			lang: validLang,
			theme: "vitesse-black",
		});
		codeBlockCache.set(cacheKey, html);
		return html;
	} catch {
		// Fallback to plain code block
		const escaped = code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		return `<pre><code>${escaped}</code></pre>`;
	}
}

// Override code block rendering with a placeholder
renderer.code = ({ text, lang }) => {
	const id = `code-${Math.random().toString(36).slice(2, 9)}`;
	const langStr = lang || "text";

	// Queue the highlight and store placeholder
	highlightCode(text, langStr).then((html) => {
		const el = document.getElementById(id);
		if (el) {
			el.outerHTML = html;
		}
	});

	// Return placeholder with escaped code as fallback
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return `<pre id="${id}"><code class="language-${langStr}">${escaped}</code></pre>`;
};

// Override inline code rendering
renderer.codespan = ({ text }) => {
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return `<code class="bg-muted px-1.5 py-0.5 rounded text-accent">${escaped}</code>`;
};

marked.setOptions({
	breaks: true,
	gfm: true,
	renderer,
});

interface MarkdownProps {
	content: string;
	class?: string;
}

export default function Markdown(props: MarkdownProps) {
	const html = createMemo(() => {
		try {
			return marked.parse(props.content, { async: false }) as string;
		} catch {
			return props.content;
		}
	});

	return (
		<div
			class={`prose prose-invert max-w-none ${props.class ?? ""}`}
			innerHTML={html()}
		/>
	);
}
