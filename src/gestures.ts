// Mobile gesture utilities

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

export function createLongPressHandlers(options: LongPressOptions): LongPressHandlers {
	const delay = options.delay ?? 500;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let didLongPress = false;

	const start = () => {
		didLongPress = false;
		timer = setTimeout(() => {
			didLongPress = true;
			options.onLongPress();
		}, delay);
	};

	const end = (e: Event) => {
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
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		didLongPress = false;
	};

	return {
		onMouseDown: start,
		onMouseUp: end,
		onMouseLeave: cancel,
		onTouchStart: start,
		onTouchEnd: end,
		onTouchCancel: cancel,
	};
}
