// Wait for the HTML content to be fully loaded
document.addEventListener("DOMContentLoaded", function () {
    // Select all cells on the game board
    const cells = document.querySelectorAll(".cell");
    // Initialize current player as "X"
    let currentPlayer = "X";
    // Initialize game board array to track moves
    let gameBoard = ["", "", "", "", "", "", "", "", ""];

    // Add click event listener to each cell
    cells.forEach((cell) => {
        cell.addEventListener("click", handleClick);
    });

    // Function to handle cell click
    function handleClick(event) {
        // Get the index of the clicked cell from the data attribute
        const index = event.target.dataset.index;

        // Check if the selected cell is empty
        if (gameBoard[index] === "") {
            // Update game board and display the current player's symbol
            gameBoard[index] = currentPlayer;
            event.target.textContent = currentPlayer;

            // Check for a winner or a tie
            if (checkWinner()) {
                alert(`${currentPlayer} wins!`);
                resetGame();
            } else if (gameBoard.every((cell) => cell !== "")) {
                alert("It's a tie!");
                resetGame();
            } else {
                // Switch to the next player
                currentPlayer = currentPlayer === "X" ? "O" : "X";
            }
        }
    }

    // Function to check for a winner
    function checkWinner() {
        const winPatterns = [
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8],
            [0, 4, 8],
            [2, 4, 6],
        ];

        // Check each winning pattern
        return winPatterns.some((pattern) => {
            const [a, b, c] = pattern;
            return (
                gameBoard[a] !== "" &&
                gameBoard[a] === gameBoard[b] &&
                gameBoard[a] === gameBoard[c]
            );
        });
    }
// Function to reset the game
function resetGame() {
    // Clear the game board and reset current player to "X"
    gameBoard = ["", "", "", "", "", "", "", "", ""];
    currentPlayer = "X";

    // Clear the content of each cell
    cells.forEach((cell) => {
        cell.textContent = "";
    });

    // Clear the game result message
    gameResult.textContent = "";
}

});
