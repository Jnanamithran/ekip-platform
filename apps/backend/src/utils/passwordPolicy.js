// Passwords people pick most often. Compared in lowercase.
// This is a starter list. Extend it (or load a bigger one from a file) later.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '123123123', '11111111', '00000000',
  'qwerty123', 'qwertyuiop', 'qwerty1234', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx',
  'abc12345', 'abcd1234', 'abcdefg1', 'iloveyou', 'iloveyou1', 'welcome1',
  'welcome123', 'admin123', 'admin1234', 'administrator', 'letmein123',
  'changeme', 'changeme1', 'default123', 'test1234', 'test12345', 'monkey123',
  'dragon123', 'football1', 'baseball1', 'sunshine1', 'princess1', 'master123',
  'login123', 'secret123', 'trustno1', 'whatever1', 'freedom1',
]);

// Returns a list of problems. An empty list means the password is fine.
function validatePassword(password) {
  if (typeof password !== 'string') return ['Password is required.'];

  const errors = [];
  if (password.length < 8) errors.push('Minimum 8 characters required.');
  // bcrypt only uses the first 72 bytes, and huge passwords waste server CPU
  if (Buffer.byteLength(password, 'utf8') > 72) errors.push('Maximum 72 UTF-8 bytes allowed.');
  if (!/[A-Z]/.test(password)) errors.push('At least 1 uppercase letter required.');
  if (!/[a-z]/.test(password)) errors.push('At least 1 lowercase letter required.');
  if (!/[0-9]/.test(password)) errors.push('At least 1 number required.');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password is too common. Choose a stronger password.');
  }
  return errors;
}

module.exports = { validatePassword };