export const db = {
  user: {
    /** Return delayed fixture data to demonstrate a server-only database call. */
    async count() {
      await new Promise((resolve) => setTimeout(resolve, 15));

      return 27;
    },
  },
};
