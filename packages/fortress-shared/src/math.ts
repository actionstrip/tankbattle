export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
