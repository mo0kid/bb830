/**
 * BB830 Auto-Layout Engine
 *
 * Understands breadboard bus connections and automatically places
 * components in sensible positions. Key rules:
 *
 * - Rows a-e share a bus (connected internally)
 * - Rows f-j share a bus (connected internally)
 * - DIP ICs straddle e-f gap, pin 1 top-left
 * - Passives run vertically (same column, spanning rows)
 * - Wires should be short horizontal/vertical jumpers
 * - Components connecting to an IC pin go near that pin's row
 */

const BOARD_ROWS = 63;

// DIP pin layout: given IC at startRow with N pins,
// left pins 1..N/2 at rows startRow..startRow+N/2-1 (column e)
// right pins N..N/2+1 at rows startRow..startRow+N/2-1 (column f)
interface ICPlacement {
  componentId: string;
  label: string;
  type: string;
  startRow: number;
  pinCount: number;
}

interface OccupiedSlot {
  row: number;
  col: string;
  componentId: string;
}

export class LayoutEngine {
  private ics: ICPlacement[] = [];
  private occupied: OccupiedSlot[] = [];
  private nextPassiveCol: Record<string, string> = {}; // per-side column rotation

  /** Register an IC placement */
  registerIC(componentId: string, label: string, type: string, startRow: number, pinCount: number) {
    this.ics.push({ componentId, label, type, startRow, pinCount });
    // Mark IC rows as occupied in columns d,e,f,g
    const pinsPerSide = pinCount / 2;
    for (let i = 0; i < pinsPerSide; i++) {
      const row = startRow + i;
      for (const col of ['d', 'e', 'f', 'g']) {
        this.occupied.push({ row, col, componentId });
      }
    }
  }

  /** Mark a position as occupied */
  markOccupied(row: number, col: string, componentId: string) {
    this.occupied.push({ row, col, componentId });
  }

  /** Mark an entire span of rows in a column as occupied */
  markSpan(row1: number, row2: number, col: string, componentId: string) {
    const minR = Math.min(row1, row2);
    const maxR = Math.max(row1, row2);
    for (let r = minR; r <= maxR; r++) {
      this.occupied.push({ row: r, col, componentId });
    }
  }

  /** Check if a position is free */
  isFree(row: number, col: string): boolean {
    return !this.occupied.some(s => s.row === row && s.col === col);
  }

  /** Find the row for a specific pin of an IC */
  getICPinRow(icLabel: string, pinIndex: number): { row: number; side: 'left' | 'right' } | null {
    const ic = this.ics.find(i => i.label === icLabel);
    if (!ic) return null;
    const pinsPerSide = ic.pinCount / 2;

    if (pinIndex < pinsPerSide) {
      // Left side: pins 0..pinsPerSide-1 at rows startRow..startRow+pinsPerSide-1
      return { row: ic.startRow + pinIndex, side: 'left' };
    } else {
      // Right side: pins pinCount-1..pinsPerSide at rows startRow..startRow+pinsPerSide-1
      const rightIdx = ic.pinCount - 1 - pinIndex;
      return { row: ic.startRow + rightIdx, side: 'right' };
    }
  }

  /** Get the IC pin row by pin name */
  getICPinRowByName(icLabel: string, pinName: string, pinDefs: Array<{ index: number; name: string }>): { row: number; side: 'left' | 'right' } | null {
    const pin = pinDefs.find(p => p.name.toUpperCase().includes(pinName.toUpperCase()));
    if (!pin) return null;
    return this.getICPinRow(icLabel, pin.index);
  }

  /**
   * Find the best placement for a 2-pin passive component connected to an IC pin.
   * Returns { row, col, row2, col2 } for vertical placement near the IC pin.
   */
  placePassiveNearPin(
    icLabel: string,
    pinIndex: number,
    otherEnd: 'vcc' | 'gnd' | 'free',
    preferredLength: number = 4,
  ): { row: number; col: string; row2: number; col2: string } | null {
    const pinInfo = this.getICPinRow(icLabel, pinIndex);
    if (!pinInfo) return null;

    const { row: pinRow, side } = pinInfo;

    // Choose column based on side: left side uses a,b,c; right side uses h,i,j
    const colOptions = side === 'left' ? ['a', 'b', 'c'] : ['h', 'i', 'j'];

    for (const col of colOptions) {
      // Pin 1 at the IC pin's row (same bus), pin 2 extends away from the IC
      const row1 = pinRow;

      if (!this.isFree(row1, col)) continue;

      // Find a free spot for pin 2, extending downward (away from IC)
      for (let offset = preferredLength; offset >= 3; offset--) {
        const row2 = row1 + offset;
        if (row2 > BOARD_ROWS) continue;
        if (!this.isFree(row2, col)) continue;

        // Check no conflicts along the path
        let pathClear = true;
        for (let r = row1 + 1; r < row2; r++) {
          if (!this.isFree(r, col)) { pathClear = false; break; }
        }
        if (!pathClear) continue;

        // Mark entire span as occupied
        this.markSpan(row1, row2, col, 'pending');

        return { row: row1, col, row2, col2: col };
      }

      // Try extending upward if downward didn't work
      for (let offset = preferredLength; offset >= 3; offset--) {
        const row2 = row1 - offset;
        if (row2 < 1) continue;
        if (!this.isFree(row2, col)) continue;

        let pathClear = true;
        for (let r = row2 + 1; r < row1; r++) {
          if (!this.isFree(r, col)) { pathClear = false; break; }
        }
        if (!pathClear) continue;

        this.markSpan(row2, row1, col, 'pending');

        return { row: row2, col, row2: row1, col2: col };
      }
    }

    return null;
  }

  /**
   * Find the best placement for a passive in a free area (not connected to IC).
   */
  placePassiveFree(
    preferredRow: number,
    side: 'left' | 'right',
    length: number = 5,
  ): { row: number; col: string; row2: number; col2: string } | null {
    const colOptions = side === 'left' ? ['a', 'b', 'c'] : ['h', 'i', 'j'];

    for (const col of colOptions) {
      for (let startRow = preferredRow; startRow <= BOARD_ROWS - length; startRow++) {
        const row2 = startRow + length;
        if (row2 > BOARD_ROWS) continue;

        let allFree = true;
        for (let r = startRow; r <= row2; r++) {
          if (!this.isFree(r, col)) { allFree = false; break; }
        }
        if (!allFree) continue;

        this.markSpan(startRow, row2, col, 'pending');
        return { row: startRow, col, row2, col2: col };
      }
    }
    return null;
  }

  /**
   * Determine the wire needed to connect a passive's far end to a rail.
   * Returns the wire definition or null if already on the rail bus.
   */
  wireToRail(
    row: number,
    col: string,
    rail: 'vcc' | 'gnd',
  ): { fromRow: number; fromCol: string; toRow: number; toCol: string; color: string } {
    // Determine which side of the board
    const colIdx = 'abcdefghij'.indexOf(col);
    const isLeft = colIdx < 5;

    const railCol = rail === 'vcc'
      ? (isLeft ? '+L' : '+R')
      : (isLeft ? '-L' : '-R');

    return {
      fromRow: row,
      fromCol: col,
      toRow: row,
      toCol: railCol,
      color: rail === 'vcc' ? 'red' : 'black',
    };
  }

  /**
   * Determine the wire needed to connect a component on one side
   * to a row on the other side of the IC (crossing the center gap).
   */
  wireCrossGap(
    fromRow: number,
    fromCol: string,
    toRow: number,
  ): { fromRow: number; fromCol: string; toRow: number; toCol: string; color: string } {
    const colIdx = 'abcdefghij'.indexOf(fromCol);
    const isLeft = colIdx < 5;

    return {
      fromRow,
      fromCol,
      toRow,
      toCol: isLeft ? 'f' : 'e',
      color: 'green',
    };
  }

  /** Find the next free row for an IC of given size */
  findFreeICRow(pinCount: number, afterRow: number = 3): number {
    const pinsPerSide = pinCount / 2;

    for (let startRow = afterRow; startRow <= BOARD_ROWS - pinsPerSide; startRow++) {
      let free = true;
      for (let i = 0; i < pinsPerSide; i++) {
        if (!this.isFree(startRow + i, 'e') || !this.isFree(startRow + i, 'f')) {
          free = false;
          break;
        }
      }
      // Also ensure 2 rows of clearance above and below
      if (free && startRow > 1 && !this.isFree(startRow - 1, 'e')) free = false;
      if (free) return startRow;
    }
    return afterRow; // fallback
  }
}
