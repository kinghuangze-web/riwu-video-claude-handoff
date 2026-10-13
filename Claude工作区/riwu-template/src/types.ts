export type Rect = [number, number, number, number];
export type Piece = {src: Rect; dst: Rect; line: number; wrap?: boolean; img: string; ink?: [number, number]};
export type Lift = {pieces: Piece[]; panel: Rect; w: number; h: number; zoom: number; bg?: string};
export type Plan = any;
