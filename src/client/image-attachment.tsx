import type { Accessor, Setter } from "solid-js";
import { For, Show } from "solid-js";

type ImageAttachmentProps = {
	images: Accessor<string[]>;
	setImages: Setter<string[]>;
	disabled?: Accessor<boolean>;
};

// Hidden file input + button to trigger it
export function ImagePickerButton(props: ImageAttachmentProps) {
	let inputRef: HTMLInputElement | undefined;

	const handleSelect = async (e: Event) => {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files?.length) return;

		const newImages: string[] = [];
		for (const file of files) {
			const reader = new FileReader();
			const base64 = await new Promise<string>((resolve) => {
				reader.onload = () => resolve(reader.result as string);
				reader.readAsDataURL(file);
			});
			newImages.push(base64);
		}
		props.setImages((prev) => [...prev, ...newImages]);
		input.value = ""; // Reset so same file can be selected again
	};

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				multiple
				class="hidden"
				onChange={handleSelect}
			/>
			<button
				type="button"
				onClick={() => inputRef?.click()}
				disabled={props.disabled?.()}
				class="px-3 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				title="Attach image"
			>
				<svg
					class="w-5 h-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
					/>
				</svg>
			</button>
		</>
	);
}

// Preview of attached images with remove buttons
export function ImagePreview(props: ImageAttachmentProps) {
	const removeImage = (index: number) => {
		props.setImages((prev) => prev.filter((_, i) => i !== index));
	};

	return (
		<Show when={props.images().length > 0}>
			<div class="w-full max-w-2xl px-4">
				<div class="flex gap-2 flex-wrap">
					<For each={props.images()}>
						{(img, index) => (
							<div class="relative">
								<img
									src={img}
									alt="Attached"
									class="h-16 w-16 object-cover rounded-lg border border-border"
								/>
								<button
									type="button"
									onClick={() => removeImage(index())}
									class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
								>
									×
								</button>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
}
