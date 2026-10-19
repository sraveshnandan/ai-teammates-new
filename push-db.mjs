import { spawn } from 'child_process';

const child = spawn('npx', ['drizzle-kit', 'push'], {
  cwd: '/home/sarvesh/Projects/ai-teammates-new/ai-teammates',
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  console.log(text);
  
  if (text.includes('Is user_id column')) {
    // Send '2' to select "rename column userid › user_id"
    child.stdin.write('2\n');
  }
});

child.stderr.on('data', (data) => {
  console.error(data.toString());
});

child.on('close', (code) => {
  console.log(`Process exited with code ${code}`);
});