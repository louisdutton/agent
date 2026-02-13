import { describe, expect, test } from "bun:test";
import { parseDiff } from "./git";

describe(parseDiff, () => {
	test("returns empty array for empty input", () => {
		expect(parseDiff("")).toEqual([]);
		expect(parseDiff("\n")).toEqual([]);
	});

	test("parses simple modification", () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("file.ts");
		expect(result[0].status).toBe("modified");
		expect(result[0].hunks).toHaveLength(1);

		const hunk = result[0].hunks[0];
		expect(hunk.header).toBe("@@ -1,3 +1,3 @@");
		expect(hunk.lines).toHaveLength(4);

		expect(hunk.lines[0]).toEqual({
			type: "context",
			content: "line1",
			oldLineNum: 1,
			newLineNum: 1,
		});
		expect(hunk.lines[1]).toEqual({
			type: "deletion",
			content: "old line",
			oldLineNum: 2,
			newLineNum: undefined,
		});
		expect(hunk.lines[2]).toEqual({
			type: "addition",
			content: "new line",
			oldLineNum: undefined,
			newLineNum: 2,
		});
		expect(hunk.lines[3]).toEqual({
			type: "context",
			content: "line3",
			oldLineNum: 3,
			newLineNum: 3,
		});
	});

	test("detects new file status", () => {
		const diff = `diff --git a/newfile.ts b/newfile.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,2 @@
+line1
+line2
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("newfile.ts");
		expect(result[0].status).toBe("added");
		expect(result[0].hunks[0].lines).toHaveLength(2);
		expect(result[0].hunks[0].lines[0].type).toBe("addition");
		expect(result[0].hunks[0].lines[1].type).toBe("addition");
	});

	test("detects deleted file status", () => {
		const diff = `diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
index abc123..0000000
--- a/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("deleted.ts");
		expect(result[0].status).toBe("deleted");
	});

	test("detects renamed file status", () => {
		const diff = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
index abc123..def456 100644
--- a/old.ts
+++ b/new.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("new.ts");
		expect(result[0].status).toBe("renamed");
	});

	test("parses multiple files", () => {
		const diff = `diff --git a/file1.ts b/file1.ts
index abc..def 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-old1
+new1
diff --git a/file2.ts b/file2.ts
index 123..456 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,1 +1,1 @@
-old2
+new2
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(2);
		expect(result[0].path).toBe("file1.ts");
		expect(result[1].path).toBe("file2.ts");
	});

	test("parses multiple hunks in one file", () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old1
+new1
 line3
@@ -10,3 +10,3 @@
 line10
-old10
+new10
 line12
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].hunks).toHaveLength(2);
		expect(result[0].hunks[0].header).toBe("@@ -1,3 +1,3 @@");
		expect(result[0].hunks[1].header).toBe("@@ -10,3 +10,3 @@");

		// Check line numbers in second hunk
		expect(result[0].hunks[1].lines[0].oldLineNum).toBe(10);
		expect(result[0].hunks[1].lines[0].newLineNum).toBe(10);
	});

	test("handles hunk headers with function context", () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -5,3 +5,4 @@ function example() {
 line1
+added
 line2
 line3
`;
		const result = parseDiff(diff);

		expect(result[0].hunks[0].header).toBe(
			"@@ -5,3 +5,4 @@ function example() {",
		);
		expect(result[0].hunks[0].lines).toHaveLength(4);
	});

	test("handles files with spaces in path", () => {
		const diff = `diff --git a/path with spaces/file.ts b/path with spaces/file.ts
index abc..def 100644
--- a/path with spaces/file.ts
+++ b/path with spaces/file.ts
@@ -1,1 +1,1 @@
-old
+new
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("path with spaces/file.ts");
	});

	test("handles additions only (no context)", () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,0 +1,3 @@
+line1
+line2
+line3
`;
		const result = parseDiff(diff);

		expect(result[0].hunks[0].lines).toHaveLength(3);
		expect(result[0].hunks[0].lines.every((l) => l.type === "addition")).toBe(
			true,
		);
		expect(result[0].hunks[0].lines[0].newLineNum).toBe(1);
		expect(result[0].hunks[0].lines[1].newLineNum).toBe(2);
		expect(result[0].hunks[0].lines[2].newLineNum).toBe(3);
	});

	test("handles deletions only (no context)", () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,0 @@
-line1
-line2
-line3
`;
		const result = parseDiff(diff);

		expect(result[0].hunks[0].lines).toHaveLength(3);
		expect(result[0].hunks[0].lines.every((l) => l.type === "deletion")).toBe(
			true,
		);
		expect(result[0].hunks[0].lines[0].oldLineNum).toBe(1);
		expect(result[0].hunks[0].lines[1].oldLineNum).toBe(2);
		expect(result[0].hunks[0].lines[2].oldLineNum).toBe(3);
	});

	test("ignores malformed diff header", () => {
		const diff = `diff --git invalid header
some random content
`;
		const result = parseDiff(diff);
		expect(result).toEqual([]);
	});

	test("handles empty content lines", () => {
		// In git diff, empty context lines have a leading space
		const diff =
			"diff --git a/file.ts b/file.ts\n" +
			"index abc..def 100644\n" +
			"--- a/file.ts\n" +
			"+++ b/file.ts\n" +
			"@@ -1,3 +1,3 @@\n" +
			" \n" + // empty context line (just a space)
			"-old\n" +
			"+new\n" +
			" \n"; // empty context line

		const result = parseDiff(diff);

		expect(result[0].hunks[0].lines).toHaveLength(4);
		expect(result[0].hunks[0].lines[0].type).toBe("context");
		expect(result[0].hunks[0].lines[0].content).toBe("");
		expect(result[0].hunks[0].lines[1].type).toBe("deletion");
		expect(result[0].hunks[0].lines[2].type).toBe("addition");
		expect(result[0].hunks[0].lines[3].type).toBe("context");
		expect(result[0].hunks[0].lines[3].content).toBe("");
	});

	test("handles binary file markers", () => {
		const diff = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abc123
Binary files /dev/null and b/image.png differ
`;
		const result = parseDiff(diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("image.png");
		expect(result[0].status).toBe("added");
		expect(result[0].hunks).toHaveLength(0);
	});

	test("handles single line file without trailing newline", () => {
		const diff = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`;
		const result = parseDiff(diff);

		// The backslash lines are skipped (they don't start with +, -, or space)
		expect(result[0].hunks[0].lines).toHaveLength(2);
	});
});
