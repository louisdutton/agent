// Cron expression parser and matcher

type CronField = {
	type: "any" | "value" | "range" | "step" | "list";
	values: number[];
};

type ParsedCron = {
	minute: CronField;
	hour: CronField;
	dayOfMonth: CronField;
	month: CronField;
	dayOfWeek: CronField;
};

function parseField(field: string, min: number, max: number): CronField {
	if (field === "*") {
		return { type: "any", values: [] };
	}

	// Step (*/5 or 1-10/2)
	if (field.includes("/")) {
		const [range, stepStr] = field.split("/");
		const step = parseInt(stepStr, 10);
		const values: number[] = [];

		if (range === "*") {
			for (let i = min; i <= max; i += step) {
				values.push(i);
			}
		} else if (range.includes("-")) {
			const [start, end] = range.split("-").map((n) => parseInt(n, 10));
			for (let i = start; i <= end; i += step) {
				values.push(i);
			}
		}
		return { type: "step", values };
	}

	// Range (1-5)
	if (field.includes("-")) {
		const [start, end] = field.split("-").map((n) => parseInt(n, 10));
		const values: number[] = [];
		for (let i = start; i <= end; i++) {
			values.push(i);
		}
		return { type: "range", values };
	}

	// List (1,3,5)
	if (field.includes(",")) {
		const values = field.split(",").map((n) => parseInt(n, 10));
		return { type: "list", values };
	}

	// Single value
	return { type: "value", values: [parseInt(field, 10)] };
}

export function parseCron(expression: string): ParsedCron | null {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return null;

	try {
		return {
			minute: parseField(parts[0], 0, 59),
			hour: parseField(parts[1], 0, 23),
			dayOfMonth: parseField(parts[2], 1, 31),
			month: parseField(parts[3], 1, 12),
			dayOfWeek: parseField(parts[4], 0, 6),
		};
	} catch {
		return null;
	}
}

function matchesField(field: CronField, value: number): boolean {
	if (field.type === "any") return true;
	return field.values.includes(value);
}

export function matchesCron(cron: ParsedCron, date: Date): boolean {
	return (
		matchesField(cron.minute, date.getMinutes()) &&
		matchesField(cron.hour, date.getHours()) &&
		matchesField(cron.dayOfMonth, date.getDate()) &&
		matchesField(cron.month, date.getMonth() + 1) &&
		matchesField(cron.dayOfWeek, date.getDay())
	);
}

// Get next run time for a cron expression
export function getNextRun(
	expression: string,
	from: Date = new Date(),
): Date | null {
	const cron = parseCron(expression);
	if (!cron) return null;

	const next = new Date(from);
	next.setSeconds(0);
	next.setMilliseconds(0);
	next.setMinutes(next.getMinutes() + 1);

	// Search up to 1 year ahead
	const maxDate = new Date(from);
	maxDate.setFullYear(maxDate.getFullYear() + 1);

	while (next < maxDate) {
		if (matchesCron(cron, next)) {
			return next;
		}
		next.setMinutes(next.getMinutes() + 1);
	}

	return null;
}

// Describe a cron expression in human terms
export function describeCron(expression: string): string {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return "Invalid expression";

	const [min, hour, dom, _month, dow] = parts;

	// Common patterns
	if (expression === "* * * * *") return "Every minute";
	if (expression === "0 * * * *") return "Every hour";
	if (expression === "0 0 * * *") return "Daily at midnight";
	if (expression === "0 9 * * *") return "Daily at 9:00 AM";
	if (expression === "0 9 * * 1-5") return "Weekdays at 9:00 AM";
	if (expression === "0 0 * * 0") return "Weekly on Sunday";
	if (expression === "0 0 1 * *") return "Monthly on the 1st";

	// Build description
	const pieces: string[] = [];

	if (min !== "*" && hour !== "*") {
		pieces.push(`at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);
	} else if (min.startsWith("*/")) {
		pieces.push(`every ${min.slice(2)} minutes`);
	} else if (hour.startsWith("*/")) {
		pieces.push(`every ${hour.slice(2)} hours`);
	}

	if (dow !== "*") {
		const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		if (dow === "1-5") {
			pieces.push("on weekdays");
		} else if (dow === "0,6") {
			pieces.push("on weekends");
		} else {
			pieces.push(`on ${days[parseInt(dow, 10)] ?? dow}`);
		}
	}

	if (dom !== "*") {
		pieces.push(`on day ${dom}`);
	}

	return pieces.join(" ") || expression;
}
