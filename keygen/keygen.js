const readline = require('readline');

const SECRET = 'SNG@PoultryFarm#2024!DevInfantary';

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).toUpperCase();
  return hex.padStart(8, '0');
}

function generateCode(machineId) {
  const combined = machineId + SECRET;
  const hash = hashCode(combined);
  return `DIP-${hash.slice(0,4)}-${hash.slice(4,8)}`;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter Machine ID: ', (machineId) => {
  const code = generateCode(machineId.trim());
  console.log('\n✅ Activation Code:', code);
  console.log('\nSend this code to the client.\n');
  rl.close();
});