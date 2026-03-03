class Main : Object {
  run  [ | 
     stringIWannaPrint := 'this is the string i wanna print\n'.

     foo := Foo new.                 "nova instance tridy Foo, foo"
     b := foo myPrint: stringIWannaPrint.

     bar := Bar new.
     c := bar myPrint: 'bar string\n'.
     d := bar quack.

    ]
}

class Foo : Object {

 "method, which prints myStr"
 myPrint: [ :myStr |
    a := myStr print.
  ] 
}

class Bar : Foo {
 quack [ |
  _ := 'quack!' print.
 ] 
}