/** The SVG primitives every tile is drawn from. */

/** Stream Deck renders key images on a 144x144 canvas. */
export const SIZE = 144;
const CORNER_RADIUS = 18;

export const COLORS = {
	"needs-input": "#f5a623",
	working: "#4a9eff",
	idle: "#3fb950",
	offline: "#6e7681",
	error: "#f85149",
	bg: "#16181d",
	dim: "#8b949e",
	text: "#e6edf3",
} as const;

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

function escapeText(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Wrap an SVG document as a data URI accepted by `setImage`. */
export function toDataUri(svg: string): string {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/**
 * `fill` is drawn behind `body` and clipped to the key's rounded corners, so a
 * gauge can occupy the whole tile without bleeding past the edge.
 */
export function keyImage(body: string, fill = ""): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<defs><clipPath id="key"><rect width="${SIZE}" height="${SIZE}" rx="${CORNER_RADIUS}"/></clipPath></defs>` +
		`<g clip-path="url(#key)">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${COLORS.bg}"/>` +
		fill +
		"</g>" +
		body +
		"</svg>"
	);
}

export interface TextOptions {
	size: number;
	fill?: string;
	weight?: number | string;
	anchor?: "start" | "middle" | "end";
	opacity?: number;
}

export function text(x: number, y: number, value: string, options: TextOptions): string {
	const { size, fill = COLORS.text, weight = 600, anchor = "middle", opacity = 1 } = options;
	return (
		`<text x="${x}" y="${y}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" ` +
		`font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}" ` +
		`text-anchor="${anchor}">${escapeText(value)}</text>`
	);
}

/** Text centred on the tile — every tile line is centred, so this is the default. */
export function centred(y: number, value: string, options: TextOptions): string {
	return text(SIZE / 2, y, value, options);
}

export function circle(cx: number, cy: number, r: number, fill: string): string {
	return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

/**
 * The tile itself is the gauge: it fills from the bottom with what is left, so
 * a full key means a full quota and an empty key means none. The fill is kept
 * translucent so the reading stays legible on top of it, with a solid line at
 * the waterline to make the level readable at a glance across the deck.
 */
export function levelFill(fraction: number, color: string): string {
	const clamped = Math.max(0, Math.min(1, fraction));
	const height = Math.round(SIZE * clamped);
	if (height <= 0) return "";

	const y = SIZE - height;
	const body = `<rect x="0" y="${y}" width="${SIZE}" height="${height}" fill="${color}" fill-opacity="0.34"/>`;
	if (clamped >= 1) return body;
	return `${body}<rect x="0" y="${y}" width="${SIZE}" height="3" fill="${color}"/>`;
}
