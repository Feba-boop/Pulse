# Pulse

Pulse is a Node.js news bot that fetches current news from an external API and displays selected information in the console.

## Features

- Fetches latest news from the Currents API
- Handles basic API errors
- Converts API responses into simplified news objects
- Removes incomplete news without a title or URL
- Removes exact duplicates based on URL
- Filters news by language
- Filters news by category
- Sorts news by publication date
- Limits the number of displayed results
- Calculates title similarity using Jaccard similarity
- Compares unique pairs of news articles
- Detects potentially similar articles using a test similarity threshold

## Planned Development

Pulse is currently an early prototype.

Future development will include:

- Persistent news storage in a database
- Multiple news sources
- Grouping related articles into events
- Comparing new articles with existing events
- Improved semantic similarity detection
- AI-based summarization and classification
- Event timelines
- Analysis of possible relationships between events
- Backend API and frontend interface

## Setup

1. Create a `.env` file in the main project folder.
2. Add your API key to the `.env` file.
3. Add `CURRENTS_API_KEY=your_api_key` to your `.env` file.
4. Run the application:

```bash
node --env-file=.env index.js
```
