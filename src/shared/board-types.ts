// BB830 breadboard physical layout types

// BB830: 63 rows, columns a-e (left) and f-j (right), plus power rails
export const BOARD_ROWS = 63;
export const BOARD_COLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
export const LEFT_COLS = ['a', 'b', 'c', 'd', 'e'] as const;
export const RIGHT_COLS = ['f', 'g', 'h', 'i', 'j'] as const;

export type BoardCol = typeof BOARD_COLS[number];

export interface HolePosition {
  row: number;            // 1-63
  col: BoardCol;          // a-j
}

export interface RailPosition {
  rail: 'power' | 'ground';
  side: 'top' | 'bottom';
  index: number;          // Position along the rail
}

export type BoardPosition = HolePosition | RailPosition;

export function isHolePosition(pos: BoardPosition): pos is HolePosition {
  return 'row' in pos && 'col' in pos;
}

export function isRailPosition(pos: BoardPosition): pos is RailPosition {
  return 'rail' in pos;
}

// A component placed on the board
export interface Placement {
  componentId: string;
  boardId: string;
  pin1Position: HolePosition;   // Where pin 1 lands
  pin2Position?: HolePosition;  // Where pin 2 lands (for 2-pin passives)
  orientation: 0 | 180;        // 0 = pin 1 at top-left, 180 = flipped
}

// A jumper wire on the board
export interface Wire {
  id: string;
  from: BoardPosition;
  to: BoardPosition;
  color: WireColor;
  netId?: string;               // Which net this wire belongs to
}

export type WireColor =
  | 'red'
  | 'black'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'white'
  | 'purple';

// A single BB830 board
export interface Board {
  id: string;
  label: string;                // 'VCO', 'VCF', 'VCA', etc.
  position: { x: number; y: number };  // Position in workspace
  placements: Placement[];
  wires: Wire[];
}

// Inter-board connection (wire between two different boards)
export interface InterBoardWire {
  id: string;
  fromBoardId: string;
  fromPosition: BoardPosition;
  toBoardId: string;
  toPosition: BoardPosition;
  color: WireColor;
  netId?: string;
}
