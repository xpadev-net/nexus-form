import type { Block } from "../../types/domain/form-block";

/**
 * ブロックがシステムブロックかどうかを判定する
 * @param block - 判定対象のブロック
 * @returns システムブロックの場合true
 */
export function isSystemBlock(block: Block): boolean {
  return block.category === "system";
}

/**
 * ブロックIDがシステムブロックのIDかどうかを判定する
 * @param blockId - 判定対象のブロックID
 * @param blocks - フォーム内の全ブロック
 * @returns システムブロックの場合true
 */
export function isSystemBlockId(blockId: string, blocks: Block[]): boolean {
  const block = blocks.find((b) => b.blockId === blockId);
  return block ? isSystemBlock(block) : false;
}
