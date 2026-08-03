/**
 * Denylist of guessable passwords, normalised to lowercase alphanumerics.
 *
 * Scope note: the classic "top 10,000" lists are dominated by short strings
 * (`123456`, `qwerty`, `letmein`) that a 12-character minimum already rejects.
 * What actually gets past a length rule is the *long* weak password — padded
 * repeats, keyboard walks, and the phrases people reach for when a site
 * suddenly demands twelve characters. That is what this list targets.
 *
 * DEFERRED: a full breach-corpus check against Have I Been Pwned's k-anonymity
 * range API. It is the right control — it catches passwords unique enough to
 * miss any static list but known to be compromised — and it needs a network
 * call with a timeout, a cache, and a decision about failing open or closed.
 * Tracked for slice 0.5's follow-up rather than silently claimed here; the
 * SRS wording says "a common-password deny list and a breach corpus", and
 * only the first half is implemented.
 */
export const COMMON_PASSWORDS = new Set([
  // Padded and repeated classics
  'password',
  'password1',
  'password123',
  'password1234',
  'password12345',
  'passwordpassword',
  'passw0rdpassw0rd',
  'p4ssw0rdp4ssw0rd',
  'password123456',
  'passwordabc123',
  'iloveyouiloveyou',
  'letmeinletmein',
  'trustno1trustno1',
  'welcomewelcome',
  'welcome123456',
  'welcometothejungle',
  'monkeymonkey',
  'football123456',
  'baseball123456',
  'superman123456',
  'sunshinesunshine',
  'princessprincess',
  'qwertyqwerty',
  'qwerty123456',
  'qwerty1234567890',
  'abc123abc123',
  'admin123456',
  'administrator',
  'administrator1',
  'changeme123',
  'changemenow',
  'defaultpassword',
  'temporarypassword',
  'mynewpassword',
  'newpassword123',
  'secretpassword',
  'thisismypassword',
  'thisisapassword',
  'mypasswordis',
  'notmypassword',

  // Keyboard walks long enough to clear a 12-character minimum
  'qwertyuiop',
  'qwertyuiopasdfghjkl',
  'qwertyuiopasdfghjklzxcvbnm',
  'asdfghjklasdf',
  'asdfghjkl123',
  'zxcvbnmzxcvbnm',
  '1qaz2wsx3edc',
  '1q2w3e4r5t6y',
  '1qazxsw23edc',
  'qazwsxedcrfv',
  'zaq12wsxcde3',
  '147258369147',

  // Numeric and date-shaped padding
  '123456789012',
  '1234567890123',
  '111111111111',
  '000000000000',
  '123123123123',
  '112233445566',
  '121212121212',
  '010203040506',

  // Phrases people reach for when a site demands length
  'letmeinplease',
  'openthedoorplease',
  'iforgotmypassword',
  'cantrememberthis',
  'whatisthispassword',
  'ihatepasswords',
  'ihatethiswebsite',
  'justletmelogin',
  'givemeaccessnow',
  'correcthorsebatterystaple',
  'tobeornottobe',
  'thequickbrownfox',
  'thequickbrownfoxjumps',
  'loremipsumdolorsitamet',
  'alliesbabaandforty',
  'starwarsstarwars',
  'harrypotter123',
  'gameofthrones123',
  'manchesterunited',
  'realmadridrealmadrid',
]);
