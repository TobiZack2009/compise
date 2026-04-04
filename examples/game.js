import {stdin,console,stdout} from "std/io"
import Random from "std/random"




let rd=isize(Random.float()*50.0)

console.log("Guess a number between 1 and 50")

while(true){
    let answer=isize(stdin.readLine())
    if (answer>rd){console.log("Too high");continue;}
    if (answer<rd){console.log("Too low");continue}
    console.log("You win!");break;
}