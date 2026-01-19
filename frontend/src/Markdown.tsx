import { marked } from "marked";
import { createMemo } from "solid-js";

// Configure marked for security and proper rendering
marked.setOptions({
	breaks: true, // Convert \n to <br>
	gfm: true, // GitHub Flavored Markdown
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
