// Runs the built desktop app with --smoke-test and fails when any check fails.
//   node scripts/smoke.mjs [path/to/executable] [result.json]
// Without a path it uses the unpacked app in release/ for this platform.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function defaultExecutable() {
  const release = path.join(root, 'release');
  const candidates =
    process.platform === 'darwin'
      ? [`mac-${process.arch}`, 'mac', 'mac-universal'].map((d) => path.join(release, d, 'Web Mapper.app/Contents/MacOS/Web Mapper'))
      : process.platform === 'win32'
        ? [path.join(release, 'win-unpacked', 'Web Mapper.exe')]
        : [path.join(release, 'linux-unpacked', 'web-mapper')];
  return candidates.find((c) => existsSync(c));
}

const exe = process.argv[2] ?? defaultExecutable();
const out = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), 'web-mapper-smoke.json'));
if (!exe || !existsSync(exe)) {
  console.error(`앱 실행 파일을 찾지 못했습니다: ${exe ?? 'release/'}`);
  process.exit(2);
}

const child = spawn(exe, [`--smoke-test=${out}`], { stdio: 'inherit' });
const timer = setTimeout(() => {
  console.error('스모크 테스트가 3분 안에 끝나지 않았습니다.');
  child.kill();
}, 180_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  if (!existsSync(out)) {
    console.error(`결과 파일이 없습니다 (종료 코드 ${code}).`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(out, 'utf8'));
  for (const [name, c] of Object.entries(report.checks)) console.log(`${c.ok === true ? 'PASS' : c.ok === 'skipped' ? 'SKIP' : 'FAIL'}  ${name}`);
  process.exit(report.ok && code === 0 ? 0 : 1);
});
