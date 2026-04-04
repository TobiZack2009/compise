import { Process } from "std/process";
import { Clock } from "std/clock";
import {console} from "std/io"
while(true){
    console.log("Hi")
    console.log(`${Process.env()}`)
}