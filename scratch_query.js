const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbPath = 'C:\\Users\\User\\AppData\\Roaming\\poultry-farm\\sng_farm.db';
  if (!fs.existsSync(dbPath)) {
    console.error('DB does not exist at:', dbPath);
    return;
  }
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  
  console.log('--- BATCHES ---');
  const batches = db.exec('SELECT * FROM batches');
  console.log(JSON.stringify(batches, null, 2));

  console.log('--- EGG SALES ---');
  const eggSales = db.exec('SELECT * FROM egg_sales');
  console.log(JSON.stringify(eggSales, null, 2));

  console.log('--- INCOME ---');
  const income = db.exec("SELECT * FROM income WHERE module_type = 'layer'");
  console.log(JSON.stringify(income, null, 2));

  console.log('--- FLOCKS ---');
  const flocks = db.exec('SELECT * FROM flocks');
  console.log(JSON.stringify(flocks, null, 2));
}

main().catch(console.error);
