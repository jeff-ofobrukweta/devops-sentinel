import { execFileSync } from 'node:child_process';

/** Integration tests execute dist/cli.js, so compile it once before any test runs. */
export default function setup(): void {
  execFileSync('npm', ['run', '--silent', 'build'], { stdio: 'inherit' });
}
