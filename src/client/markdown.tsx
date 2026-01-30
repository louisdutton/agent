import { marked } from "marked";
import { createMemo } from "solid-js";
import { hljs } from "./hljs";

// Create a custom renderer that handles code blocks
const renderer = new marked.Renderer();

// Synchronous highlighting with highlight.js
function highlightCode(code: string, lang: string): string {
	try {
		if (lang && hljs.getLanguage(lang)) {
			return hljs.highlight(code, { language: lang }).value;
		}
		return hljs.highlightAuto(code).value;
	} catch {
		const escaped = code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		return escaped;
	}
}

// Override code block rendering - now synchronous
renderer.code = ({ text, lang }) => {
	const langStr = lang || "";
	const highlighted = highlightCode(text, langStr);
	return `<pre><code class="hljs${langStr ? ` language-${langStr}` : ""}">${highlighted}</code></pre>`;
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

export function Markdown(props: MarkdownProps) {
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
