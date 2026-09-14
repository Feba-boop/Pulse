# Pulse

Pulse is a Node.js news bot that fetches current news from an external API and displays selected information in the console.

## Features

- Fetches current news from an API
- Displays titles, dates, and URLs
- Limits the number of displayed news articles
- Handles basic API errors

## Setup

1. Create a `.env` file in the main project folder.
2. Add your API key to the `.env` file.
3. Add `CURRENTS_API_KEY=your_api_key` to your `.env` file.
4. Run the application:

```bash
node --env-file=.env index.js