import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, encryptionKeyFromSecret } from '../crypto.js';


describe('crypto', () => {
  const secret = 'test-secret-key-for-encryption!!';
  const key = encryptionKeyFromSecret(secret);

  describe('encrypt / decrypt', () => {
    it('round-trips a plaintext string', () => {
      const plaintext = 'my-secret-refresh-token';
      const ciphertext = encrypt(plaintext, key);
      const decrypted = decrypt(ciphertext, key);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'same-token';
      const ct1 = encrypt(plaintext, key);
      const ct2 = encrypt(plaintext, key);
      expect(ct1).not.toBe(ct2);
      // But both decrypt to the same value
      expect(decrypt(ct1, key)).toBe(plaintext);
      expect(decrypt(ct2, key)).toBe(plaintext);
    });

    it('handles empty string', () => {
      const ciphertext = encrypt('', key);
      expect(decrypt(ciphertext, key)).toBe('');
    });

    it('handles unicode content', () => {
      const plaintext = '🎵 música ñ àéîöü';
      const ciphertext = encrypt(plaintext, key);
      expect(decrypt(ciphertext, key)).toBe(plaintext);
    });

    it('throws with wrong key', () => {
      const ciphertext = encrypt('secret', key);
      const wrongKey = encryptionKeyFromSecret('wrong-secret-key!!!!!!!!!!!!!!');
      expect(() => decrypt(ciphertext, wrongKey)).toThrow();
    });

    it('throws with corrupted ciphertext', () => {
      const ciphertext = encrypt('secret', key);
      const corrupted = ciphertext.slice(0, -5) + 'XXXXX';
      expect(() => decrypt(corrupted, key)).toThrow();
    });
  });

  describe('encryptionKeyFromSecret', () => {
    it('produces a 32-byte buffer', () => {
      const key = encryptionKeyFromSecret('any-secret');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('is deterministic', () => {
      const k1 = encryptionKeyFromSecret('same-secret');
      const k2 = encryptionKeyFromSecret('same-secret');
      expect(k1.equals(k2)).toBe(true);
    });

    it('different secrets produce different keys', () => {
      const k1 = encryptionKeyFromSecret('secret-a');
      const k2 = encryptionKeyFromSecret('secret-b');
      expect(k1.equals(k2)).toBe(false);
    });
  });
});
