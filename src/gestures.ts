// Mobile gesture utilities

import { createSignal, type Accessor } from "solid-js";

export type LongPressHandlers = {
	onMouseDown: (e: MouseEvent) => void;
	onMouseUp: (e: MouseEvent) => void;
	onMouseLeave: (e: MouseEvent) => void;
	onTouchStart: (e: TouchEvent) => void;
	onTouchEnd: (e: TouchEvent) => void;
	onTouchCancel: (e: TouchEvent) => void;
};

export type LongPressOptions = {
	onPress: () => void;
	onLongPress: () => void;
	delay?: number; // Default 500ms
};

export type LongPressResult = {
	handlers: LongPressHandlers;
	isPressing: Accessor<boolean>;
};

export function createLongPress(options: LongPressOptions): LongPressResult {
	const delay = options.delay ?? 500;
	const [isPressing, setIsPressing] = createSignal(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let didLongPress = false;

	const start = () => {
		didLongPress = false;
		setIsPressing(true);
		timer = setTimeout(() => {
			didLongPress = true;
			setIsPressing(false);
			options.onLongPress();
		}, delay);
	};

	const end = (e: Event) => {
		setIsPressing(false);
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!didLongPress) {
			options.onPress();
		}
		// Prevent click event after long press on touch
		if (didLongPress) {
			e.preventDefault();
		}
	};

	const cancel = () => {
		setIsPressing(false);
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		didLongPress = false;
	};

	return {
		handlers: {
			onMouseDown: start,
			onMouseUp: end,
			onMouseLeave: cancel,
			onTouchStart: start,
			onTouchEnd: end,
			onTouchCancel: cancel,
		},
		isPressing,
	};
}

// Legacy wrapper for backwards compatibility
export function createLongPressHandlers(options: LongPressOptions): LongPressHandlers {
	return createLongPress(options).handlers;
}
