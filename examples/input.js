// Demonstrates: std/io stdin.read and stdin.readAll.
import { console, stdin } from "std/io";

let x=stdin.readLine();
console.log("Hello\n")
console.log(x)
let len=4;
while(true){
    len++;
    x=stdin.readLine();
    console.log("\n")
    console.log(x)
    console.log("\n")
    
}