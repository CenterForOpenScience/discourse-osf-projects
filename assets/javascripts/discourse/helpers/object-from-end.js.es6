export default Ember.Handlebars.makeBoundHelper( function(array, index) {
    return array[array.length - 1 - index];
});
