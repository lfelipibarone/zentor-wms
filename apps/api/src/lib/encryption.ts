import * as crypto from "crypto";

const KEY_FROM_ENV = process.env.ENCRYPTION_KEY?.trim();

let ENCRYPTION_KEY: string;
if (KEY_FROM_ENV) {
  ENCRYPTION_KEY = KEY_FROM_ENV;
} else if (process.env.NODE_ENV === "production") {
  throw new Error(
    "ENCRYPTION_KEY é obrigatória em produção. Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
} else {
  ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[encryption] ENCRYPTION_KEY não definida: usando chave aleatória por execução.",
  );
}

function getEncryptionKey(): Buffer {
  if (ENCRYPTION_KEY.length === 64) {
    try {
      return Buffer.from(ENCRYPTION_KEY, "hex");
    } catch {
      return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
    }
  }
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  if (!text) return text;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

export function decrypt(encryptedText: string, allowPlainText = false): string {
  if (!encryptedText) return encryptedText;
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    if (allowPlainText) return encryptedText;
    throw new Error("Formato de texto criptografado inválido");
  }
  const key = getEncryptionKey();
  const [ivBase64, authTagBase64, encrypted] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
