"Example of passing vars into a function"

class Main : Object {
  run  [ | 
     "d := 'ahoj \n' print."

     " the following calls this.foobar with two params"
     c := self foo: 'passingThis' bar: 'passingSecondArg'. 

    ]
  
  foo:bar: [ :a :b |
    "prints the received a param" 
    q := a print.
  ]
}