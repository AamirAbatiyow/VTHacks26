import {
  BinaryMsgType,
  type BinaryMsgTypeValue,
} from "../../../shared/events.js";

/**
 * Encode a binary audio frame:
 *   [1 byte msgType][1 byte genIdLen][genId UTF-8][payload]
 */
export function encodeBinaryFrame(
  msgType: BinaryMsgTypeValue,
  payload: Buffer | Uint8Array,
  generationId = "",
): Buffer {
  const idBuf = Buffer.from(generationId, "utf8");
  if (idBuf.length > 255) {
    throw new Error("generationId too long for binary framing");
  }
  const header = Buffer.alloc(2 + idBuf.length);
  header[0] = msgType;
  header[1] = idBuf.length;
  if (idBuf.length > 0) idBuf.copy(header, 2);
  return Buffer.concat([header, Buffer.from(payload)]);
}

export interface DecodedBinaryFrame {
  msgType: BinaryMsgTypeValue;
  generationId: string;
  payload: Buffer;
}

export function decodeBinaryFrame(data: Buffer): DecodedBinaryFrame | null {
  if (data.length < 2) return null;
  const msgType = data[0] as BinaryMsgTypeValue;
  if (
    msgType !== BinaryMsgType.MIC_AUDIO &&
    msgType !== BinaryMsgType.ASSISTANT_AUDIO
  ) {
    return null;
  }
  const genIdLen = data[1]!;
  if (data.length < 2 + genIdLen) return null;
  const generationId =
    genIdLen > 0 ? data.subarray(2, 2 + genIdLen).toString("utf8") : "";
  const payload = data.subarray(2 + genIdLen);
  return { msgType, generationId, payload };
}

export { BinaryMsgType };
