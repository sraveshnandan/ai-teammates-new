import { spawn } from 'child_process';

const child = spawn('npx', ['drizzle-kit', 'push'], {
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: true
});

child.stdin.write('y\n');
child.stdin.end();
