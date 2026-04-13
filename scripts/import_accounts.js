import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import accountPoolService from '../server/services/accountPoolService.js';
import { initDatabase } from '../server/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printUsage() {
  console.log(`
用法:
  node scripts/import_accounts.js <文件路径> [--no-overwrite]

示例:
  node scripts/import_accounts.js ./zhanghao.txt
  node scripts/import_accounts.js ./accounts.csv --no-overwrite
`);
}

function resolveInputFile(input) {
  if (!input) {
    return path.resolve(process.cwd(), 'zhanghao.txt');
  }

  if (path.isAbsolute(input)) {
    return input;
  }

  const cwdPath = path.resolve(process.cwd(), input);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  return path.resolve(__dirname, '..', input);
}

async function runImport() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const fileArg = args.find((arg) => !arg.startsWith('--'));
  const overwriteExisting = !args.includes('--no-overwrite');
  const filePath = resolveInputFile(fileArg);

  if (!fs.existsSync(filePath)) {
    console.error(`[Import] 文件不存在: ${filePath}`);
    printUsage();
    process.exit(1);
  }

  initDatabase();

  console.log(`[Import] 开始导入账号文件: ${filePath}`);
  console.log(`[Import] 覆盖已存在账号: ${overwriteExisting ? '是' : '否'}`);

  try {
    const stats = accountPoolService.importFromTextFile(filePath, { overwriteExisting });
    console.log('[Import] 导入完成，统计结果如下:');
    console.table({
      total: stats.total,
      imported: stats.imported,
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      errors: stats.errors,
    });

    if (Array.isArray(stats.errorLines) && stats.errorLines.length > 0) {
      console.log('\n[Import] 错误示例:');
      for (const message of stats.errorLines.slice(0, 10)) {
        console.log(`- ${message}`);
      }
    }

    const dbStats = accountPoolService.getStats();
    console.log('\n[Database] 当前账号池统计:');
    console.table(dbStats);
  } catch (error) {
    console.error('[Import] 导入失败:', error?.message || error);
    process.exit(1);
  }
}

runImport();
