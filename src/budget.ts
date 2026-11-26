/**
 * 1 回の定期実行で使える外部リクエスト数の管理（docs/spec.md §4）
 *
 * Workers 無料プランには「1 回の実行で送れるリクエスト数」の上限がある。
 * 上限に近づいたらその回の処理を打ち切り、残りのユーザーは次回に回す。
 */

/** 1 回の実行で使ってよい外部リクエスト数。無料プランの上限（50 程度、要確認）より少し余裕を持たせる */
export const MAX_REQUESTS_PER_RUN = 45;

export class BudgetExceededError extends Error {
  constructor() {
    super("この実行で使えるリクエスト数の上限に達しました");
  }
}

export class RequestBudget {
  constructor(private remaining: number = MAX_REQUESTS_PER_RUN) {}

  /** あと n 回リクエストできるか */
  canSpend(n = 1): boolean {
    return this.remaining >= n;
  }

  /** 1 回分を使う。残りがなければ例外を投げる */
  spend(): void {
    if (this.remaining <= 0) throw new BudgetExceededError();
    this.remaining--;
  }

  /** 必要な回数が残っていなければ、リクエストを始める前に打ち切る */
  require(n: number): void {
    if (!this.canSpend(n)) throw new BudgetExceededError();
  }

  get left(): number {
    return this.remaining;
  }
}
