export default Ember.Helper.helper(function(params) {
    let array = params[0];
    let index = params[1];
    return array[array.length - 1 - index];
});
