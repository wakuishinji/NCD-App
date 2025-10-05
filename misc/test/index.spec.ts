import { describe, it, expect } from 'vitest';

// 現状はビルド環境の疎通確認のみを行う。将来的にWorkers実装をモック化して
// 具体的なAPI呼び出しテストへ置き換える予定。

describe('vitest setup', () => {
  it('executes a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
