# Local Development Setup Instructions for Linux

## Prerequisites
Before you start, make sure you have the following installed:
- **Node.js** (version 14 or above)
- **npm** (Node package manager)
- **Git**

## Clone the Repository
Open a terminal and run:
```bash
git clone https://github.com/joanmaria-valls/arbitres_mn.git
cd arbitres_mn
```

## Install Dependencies
Execute the following command to install the required packages:
```bash
npm install
```

## Run the Application
Use the command below to start the development server:
```bash
npm start
```

## Additional Configuration
You might want to set up a `.env` file for environment-specific settings. Here’s a sample:
```.env
PORT=3000
DATABASE_URL=mysql://username:password@localhost:3306/dbname
```
Change the `username`, `password`, and `dbname` accordingly.

## Testing
Run the following command to execute tests:
```bash
npm test
```

## Troubleshooting
- Ensure that all dependencies are correctly installed.
- Check your Node.js version if you encounter compatibility issues.

For any other issues, refer to the [documentation](https://example.com/docs).