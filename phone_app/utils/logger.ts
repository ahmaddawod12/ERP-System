type LogArgs = unknown[];

const isDevRuntime = typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';

export const logger = {
  debug: (...args: LogArgs) => {
    if (isDevRuntime) {
      console.log(...args);
    }
  },
  warn: (...args: LogArgs) => {
    console.warn(...args);
  },
  error: (...args: LogArgs) => {
    console.error(...args);
  },
};
