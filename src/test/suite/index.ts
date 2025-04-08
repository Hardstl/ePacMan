import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * Runs all tests in the test folder
 * @returns Promise that resolves when tests complete
 */
export function run(): Promise<void> {
	// Create the mocha test runner
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise<void>((c, e) => {
		// Find all test files that match the pattern
		glob('**/**.test.js', { cwd: testsRoot }).then(files => {
			// Add all files to the mocha runner
			files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the tests
				mocha.run((failures: number) => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				console.error(err);
				e(err);
			}
		}).catch(err => {
			e(err);
		});
	});
}