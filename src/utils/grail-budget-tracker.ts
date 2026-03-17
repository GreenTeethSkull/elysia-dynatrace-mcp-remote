/**
 * Grail Budget Tracker - tracks and limits bytes scanned by Grail queries.
 */

export interface GrailBudgetState {
  totalBytesScanned: number;
  budgetLimitBytes: number;
  budgetLimitGB: number;
  isBudgetExceeded: boolean;
  remainingBudgetBytes: number;
  remainingBudgetGB: number;
}

class GrailBudgetTrackerImpl {
  private _totalBytesScanned = 0;
  private readonly _budgetLimitBytes: number;
  private readonly _budgetLimitGB: number;
  private readonly _unlimited: boolean;

  constructor(budgetLimitGB: number) {
    this._budgetLimitGB = budgetLimitGB;
    this._unlimited = budgetLimitGB === -1;
    this._budgetLimitBytes = this._unlimited
      ? Number.POSITIVE_INFINITY
      : budgetLimitGB * 1000 * 1000 * 1000;
  }

  get isBudgetExceeded(): boolean {
    return this._unlimited
      ? false
      : this._totalBytesScanned >= this._budgetLimitBytes;
  }

  addBytesScanned(bytesScanned: number): GrailBudgetState {
    this._totalBytesScanned += bytesScanned;
    return this.getState();
  }

  getState(): GrailBudgetState {
    return {
      totalBytesScanned: this._totalBytesScanned,
      budgetLimitBytes: this._unlimited ? -1 : this._budgetLimitBytes,
      budgetLimitGB: this._budgetLimitGB,
      isBudgetExceeded: this.isBudgetExceeded,
      remainingBudgetBytes: this._unlimited
        ? -1
        : Math.max(0, this._budgetLimitBytes - this._totalBytesScanned),
      remainingBudgetGB: this._unlimited
        ? -1
        : Math.max(0, this._budgetLimitBytes - this._totalBytesScanned) /
          (1000 * 1000 * 1000),
    };
  }

  reset(): void {
    this._totalBytesScanned = 0;
  }
}

let globalBudgetTracker: GrailBudgetTrackerImpl | null = null;

export function getGrailBudgetTracker(
  budgetLimitGB?: number,
): GrailBudgetTrackerImpl {
  if (!globalBudgetTracker) {
    globalBudgetTracker = new GrailBudgetTrackerImpl(budgetLimitGB ?? 1000);
  }
  return globalBudgetTracker;
}

export function resetGrailBudgetTracker(): void {
  globalBudgetTracker = null;
}

export function formatBytesAsGB(bytes: number): string {
  const gb = bytes / (1000 * 1000 * 1000);
  if (gb >= 10) return gb.toFixed(1);
  if (gb >= 1) return gb.toFixed(2);
  if (gb >= 0.1) return gb.toFixed(3);
  return gb.toFixed(4);
}

export function generateBudgetWarning(
  budgetState: GrailBudgetState,
  currentQueryBytes: number,
): string | null {
  if (budgetState.isBudgetExceeded) {
    const totalGB = formatBytesAsGB(budgetState.totalBytesScanned);
    const currentGB = formatBytesAsGB(currentQueryBytes);
    return `Grail Budget Exceeded: This query scanned ${currentGB} GB. Total session usage: ${totalGB} GB / ${budgetState.budgetLimitGB} GB budget limit. No more queries allowed in this session.`;
  }

  const usagePercentage =
    (budgetState.totalBytesScanned / budgetState.budgetLimitBytes) * 100;
  if (usagePercentage >= 80) {
    const remainingGB = formatBytesAsGB(budgetState.remainingBudgetBytes);
    const totalGB = formatBytesAsGB(budgetState.totalBytesScanned);
    return `Grail Budget Warning: Session usage: ${totalGB} GB / ${budgetState.budgetLimitGB} GB (${usagePercentage.toFixed(1)}%). Remaining: ${remainingGB} GB.`;
  }

  return null;
}
