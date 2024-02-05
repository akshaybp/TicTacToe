// Variables to track game state
let gameBoard = ["", "", "", "", "", "", "", "", ""];
let currentPlayer = "X";
let gameResult = document.getElementById("game-result");
const cells = document.querySelectorAll(".cell");

// Function to check for a winner
function checkWinner() {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (gameBoard[a] && gameBoard[a] === gameBoard[b] && gameBoard[a] === gameBoard[c]) {
            return gameBoard[a]; // Return the winner (X or O)
        }
    }

    // Check for a tie
    if (!gameBoard.includes("")) {
        return "Tie";
    }

    return null; // No winner or tie yet
}

// Function to handle cell click
function handleCellClick(index) {
    if (gameBoard[index] === "" && !gameResult.textContent) {
        gameBoard[index] = currentPlayer;
        cells[index].textContent = currentPlayer;
        cells[index].classList.add(currentPlayer);

        const winner = checkWinner();
        if (winner) {
            if (winner === "Tie") {
                displayResult("It's a Tie!");
            } else {
                displayResult(`${winner} wins!`);
            }
        } else {
            currentPlayer = currentPlayer === "X" ? "O" : "X";
        }
    }
}

// Function to display the game result message
function displayResult(result) {
    gameResult.textContent = result;
}

// Function to reset the game
function resetGame() {
    // Clear the game board and reset current player to "X"
    gameBoard = ["", "", "", "", "", "", "", "", ""];
    currentPlayer = "X";

    // Clear the content and styling of each cell
    cells.forEach((cell) => {
        cell.textContent = "";
        cell.classList.remove("X", "O");
    });

    // Clear the game result message
    gameResult.textContent = "";
}

// Add click event listeners to each cell
cells.forEach((cell, index) => {
    cell.addEventListener("click", () => handleCellClick(index));
});
