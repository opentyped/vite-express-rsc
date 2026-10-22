import "server-only";

const SERVER_DATABASE_SECRET = "database-server-only-marker";

export const db = {
  user: {
    async count() {
      await new Promise((resolve) => setTimeout(resolve, 15));

      return SERVER_DATABASE_SECRET.length;
    },
  },
};
